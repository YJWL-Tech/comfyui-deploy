import type { App } from "@/routes/app";
import { authError } from "@/routes/authError";
import { z, createRoute } from "@hono/zod-openapi";
import {
  S3,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3({
  endpoint: process.env.SPACES_ENDPOINT,
  region: process.env.SPACES_REGION,
  credentials: {
    accessKeyId: process.env.SPACES_KEY!,
    secretAccessKey: process.env.SPACES_SECRET!,
  },
  forcePathStyle: process.env.SPACES_CDN_FORCE_PATH_STYLE === "true",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// List files and folders route
const listFilesRoute = createRoute({
  method: "get",
  path: "/files/list",
  tags: ["files"],
  summary: "List files and folders in S3",
  description: "List all files and folders in a given S3 path",
  request: {
    query: z.object({
      prefix: z.string().optional().default(""),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            folders: z.array(z.object({
              name: z.string(),
              prefix: z.string(),
            })),
            files: z.array(z.object({
              name: z.string(),
              key: z.string(),
              size: z.number(),
              lastModified: z.string(),
              url: z.string().optional(),
            })),
          }),
        },
      },
      description: "List of files and folders",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Error listing files",
    },
    ...authError,
  },
});

// Create folder route
const createFolderRoute = createRoute({
  method: "post",
  path: "/files/create-folder",
  tags: ["files"],
  summary: "Create a folder in S3",
  description: "Create a new folder (directory) in S3",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            path: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            path: z.string(),
          }),
        },
      },
      description: "Folder created successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Error creating folder",
    },
    ...authError,
  },
});

// Delete file or folder route
const deleteFileRoute = createRoute({
  method: "delete",
  path: "/files/delete",
  tags: ["files"],
  summary: "Delete a file or folder",
  description: "Delete a file or folder from S3",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            key: z.string(),
            isFolder: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
      description: "File or folder deleted successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Error deleting file or folder",
    },
    ...authError,
  },
});

// Generate upload URL route
const generateUploadUrlRoute = createRoute({
  method: "post",
  path: "/files/generate-upload-url",
  tags: ["files"],
  summary: "Generate upload URL",
  description: "Generate a presigned URL for uploading a file to S3",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            key: z.string(),
            contentType: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            uploadUrl: z.string(),
            key: z.string(),
          }),
        },
      },
      description: "Upload URL generated successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Error generating upload URL",
    },
    ...authError,
  },
});

// Get download URL route
const getDownloadUrlRoute = createRoute({
  method: "get",
  path: "/files/download-url",
  tags: ["files"],
  summary: "Get download URL",
  description: "Get a presigned URL for downloading a file from S3",
  request: {
    query: z.object({
      key: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            downloadUrl: z.string(),
          }),
        },
      },
      description: "Download URL generated successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Error generating download URL",
    },
    ...authError,
  },
});

export const registerFilesRoute = (app: App) => {
  const bucket = process.env.SPACES_BUCKET!;

  // List files and folders
  app.openapi(listFilesRoute, async (c) => {
    const { prefix } = c.req.valid("query");
    const tokenData = c.get("apiKeyTokenData");

    if (!tokenData?.user_id) {
      return c.json(
        { error: "Invalid user_id" },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      // Add user_id to prefix to isolate user files
      // Ensure the prefix ends with / if not empty, so we list contents of the folder
      let normalizedPrefix = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
      if (normalizedPrefix) {
        normalizedPrefix += "/";
      }
      const userPrefix = `files/${tokenData.user_id}/${normalizedPrefix}`;
      
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: userPrefix,
        Delimiter: "/",
      });

      const response = await s3Client.send(command);

      // Process folders (CommonPrefixes)
      const folders = (response.CommonPrefixes || [])
        .map((prefix) => {
          const fullPrefix = prefix.Prefix!;
          const afterUserPrefix = fullPrefix.replace(userPrefix, "");
          const withoutTrailingSlash = afterUserPrefix.replace(/\/+$/, "");
          const segments = withoutTrailingSlash.split("/").filter(Boolean);
          const name = segments.pop() || "";
          const prefixResult = fullPrefix.replace(`files/${tokenData.user_id}/`, "").replace(/\/+$/, "");
          
          return {
            name,
            prefix: prefixResult,
          };
        })
        .filter((folder) => folder.name !== ""); // Filter out folders with empty names

      // Process files (Contents)
      const files = (response.Contents || [])
        .filter((item) => {
          // Filter out folder markers (keys ending with /)
          if (item.Key === userPrefix) return false;
          if (item.Key!.endsWith("/")) return false;
          return true;
        })
        .map((item) => {
          const pathSegments = item.Key!.split("/").filter(Boolean);
          const name = pathSegments[pathSegments.length - 1] || item.Key!;
          return {
            name,
            key: item.Key!.replace(`files/${tokenData.user_id}/`, ""),
            size: item.Size || 0,
            lastModified: item.LastModified?.toISOString() || "",
          };
        })
        .filter((file) => file.name !== ""); // Filter out files with empty names

      return c.json(
        {
          folders,
          files,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.json(
        { error: errorMessage },
        { status: 500, headers: corsHeaders }
      );
    }
  });

  // Create folder
  app.openapi(createFolderRoute, async (c) => {
    const { path } = c.req.valid("json");
    const tokenData = c.get("apiKeyTokenData");

    if (!tokenData?.user_id) {
      return c.json(
        { error: "Invalid user_id" },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      // Normalize path: remove leading/trailing slashes and collapse multiple slashes
      const normalizedPath = path
        .replace(/^\/+/, "") // Remove leading slashes
        .replace(/\/+$/, "") // Remove trailing slashes
        .replace(/\/+/g, "/"); // Collapse multiple slashes to single slash
      
      // Add user_id to path and ensure it ends with /
      const folderKey = `files/${tokenData.user_id}/${normalizedPath}/`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: folderKey,
        Body: "",
      });

      await s3Client.send(command);

      return c.json(
        {
          success: true,
          path: path,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.json(
        { error: errorMessage },
        { status: 500, headers: corsHeaders }
      );
    }
  });

  // Delete file or folder
  app.openapi(deleteFileRoute, async (c) => {
    const { key, isFolder } = c.req.valid("json");
    const tokenData = c.get("apiKeyTokenData");

    if (!tokenData?.user_id) {
      return c.json(
        { error: "Invalid user_id" },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      // Normalize key: remove leading slashes and collapse multiple slashes
      const normalizedKey = key
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
      
      const fullKey = `files/${tokenData.user_id}/${normalizedKey}`;

      if (isFolder) {
        // List all objects with this prefix
        const listCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: fullKey.endsWith("/") ? fullKey : `${fullKey}/`,
        });

        const listResponse = await s3Client.send(listCommand);

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          // Delete all objects in the folder
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: listResponse.Contents.map((item) => ({ Key: item.Key })),
            },
          });

          await s3Client.send(deleteCommand);
        }
      } else {
        // Delete single file
        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucket,
          Key: fullKey,
        });

        await s3Client.send(deleteCommand);
      }

      return c.json(
        {
          success: true,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.json(
        { error: errorMessage },
        { status: 500, headers: corsHeaders }
      );
    }
  });

  // Generate upload URL
  app.openapi(generateUploadUrlRoute, async (c) => {
    const { key, contentType } = c.req.valid("json");
    const tokenData = c.get("apiKeyTokenData");

    if (!tokenData?.user_id) {
      return c.json(
        { error: "Invalid user_id" },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      // Normalize key: remove leading slashes and collapse multiple slashes
      const normalizedKey = key
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
      
      const fullKey = `files/${tokenData.user_id}/${normalizedKey}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 60 * 60, // 1 hour
      });

      return c.json(
        {
          uploadUrl,
          key,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.json(
        { error: errorMessage },
        { status: 500, headers: corsHeaders }
      );
    }
  });

  // Get download URL
  app.openapi(getDownloadUrlRoute, async (c) => {
    const { key } = c.req.valid("query");
    const tokenData = c.get("apiKeyTokenData");

    if (!tokenData?.user_id) {
      return c.json(
        { error: "Invalid user_id" },
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      // Normalize key: remove leading slashes and collapse multiple slashes
      const normalizedKey = key
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
      
      const fullKey = `files/${tokenData.user_id}/${normalizedKey}`;

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: fullKey,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 60 * 60, // 1 hour
      });

      return c.json(
        {
          downloadUrl,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.json(
        { error: errorMessage },
        { status: 500, headers: corsHeaders }
      );
    }
  });
};

