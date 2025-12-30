import { OutputRender } from "./OutputRender";
import { CodeBlock } from "@/components/CodeBlock";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRunsOutput } from "@/server/getRunsOutput";

// 支持的图片扩展名
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

// 检查 URL 是否是图片
function isImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// 检查字符串是否看起来像图片 URL（包括没有扩展名的情况）
function looksLikeImageUrl(url: string): boolean {
  // 先检查是否有图片扩展名
  if (isImageUrl(url)) return true;
  
  // 检查是否是有效的 HTTP(S) URL
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

// 解析输入值，提取图片 URL
function extractImageUrls(data: unknown): string[] {
  const urls: string[] = [];
  
  // 处理数组类型（原生数组）
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string") {
        if (item.startsWith("data:image/") || looksLikeImageUrl(item)) {
          urls.push(item);
        }
      }
    }
    return urls;
  }
  
  if (typeof data === "string") {
    // 检查是否是 base64 图片
    if (data.startsWith("data:image/")) {
      urls.push(data);
      return urls;
    }
    
    // 尝试解析为 JSON 数组（用于 ExternalImageBatch）
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && (looksLikeImageUrl(item) || item.startsWith("data:image/"))) {
            urls.push(item);
          }
        }
        if (urls.length > 0) return urls;
      }
    } catch {
      // 不是 JSON，继续检查是否是单个 URL
    }
    
    // 检查是否是单个图片 URL
    if (looksLikeImageUrl(data)) {
      urls.push(data);
    }
  }
  
  return urls;
}

type WorkflowInputs = Record<string, string | number> | null;

export async function RunOutputs({
  run_id,
  workflow_inputs
}: {
  run_id: string;
  workflow_inputs?: WorkflowInputs;
}) {
  const outputs = await getRunsOutput(run_id);

  // 收集所有输入图片
  const inputImages: { key: string; urls: string[] }[] = [];
  if (workflow_inputs) {
    Object.entries(workflow_inputs).forEach(([key, value]) => {
      const urls = extractImageUrls(value);
      if (urls.length > 0) {
        inputImages.push({ key, urls });
      }
    });
  }

  // 收集所有输出文件（images, files, gifs）
  const allFiles: { id: string; filename: string; type: 'image' | 'file' | 'gif' }[] = [];

  outputs?.forEach((run) => {
    // 添加所有图片
    if (run.data.images && Array.isArray(run.data.images)) {
      run.data.images.forEach((img: { filename: string }, index: number) => {
        if (img.filename) {
          allFiles.push({ id: `${run.id}-img-${index}`, filename: img.filename, type: 'image' });
        }
      });
    }
    // 添加所有文件
    if (run.data.files && Array.isArray(run.data.files)) {
      run.data.files.forEach((file: { filename: string }, index: number) => {
        if (file.filename) {
          allFiles.push({ id: `${run.id}-file-${index}`, filename: file.filename, type: 'file' });
        }
      });
    }
    // 添加所有 GIF
    if (run.data.gifs && Array.isArray(run.data.gifs)) {
      run.data.gifs.forEach((gif: { filename: string }, index: number) => {
        if (gif.filename) {
          allFiles.push({ id: `${run.id}-gif-${index}`, filename: gif.filename, type: 'gif' });
        }
      });
    }
  });

  // 如果没有输出文件，显示原始 JSON 数据
  if (allFiles.length === 0 && outputs && outputs.length > 0) {
    return (
      <div className="space-y-4">
        {/* 输入图片区域 */}
        {inputImages.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Inputs</h4>
            <div className="flex flex-wrap gap-4">
              {inputImages.map(({ key, urls }) => (
                <div key={key} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{key}</span>
                  <div className="flex flex-wrap gap-2">
                    {urls.map((url, index) => (
                      <img
                        key={index}
                        className="max-w-[150px] max-h-[150px] object-contain rounded border"
                        src={url}
                        alt={`${key} input ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 输出区域 */}
        <Table className="table-fixed">
          <TableHeader className="bg-background top-0 sticky">
            <TableRow>
              <TableHead className="w-[200px]">File</TableHead>
              <TableHead className="">Output</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outputs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>Output</TableCell>
                <TableCell className="">
                  <CodeBlock
                    code={JSON.stringify(run.data, null, 2)}
                    lang="json"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 输入图片区域 */}
      {inputImages.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">Inputs</h4>
          <div className="flex flex-wrap gap-4">
            {inputImages.map(({ key, urls }) => (
              <div key={key} className="space-y-1">
                <span className="text-xs text-muted-foreground">{key}</span>
                <div className="flex flex-wrap gap-2">
                  {urls.map((url, index) => (
                    <img
                      key={index}
                      className="max-w-[150px] max-h-[150px] object-contain rounded border"
                      src={url}
                      alt={`${key} input ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输出区域 */}
      {allFiles.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">Outputs</h4>
          <Table className="table-fixed">
            <TableHeader className="bg-background top-0 sticky">
              <TableRow>
                <TableHead className="w-[200px]">File</TableHead>
                <TableHead className="">Output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allFiles.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="break-words">{file.filename}</TableCell>
                  <TableCell>
                    <OutputRender run_id={run_id} filename={file.filename} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
