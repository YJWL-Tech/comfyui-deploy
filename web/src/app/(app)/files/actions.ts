"use server";

import { auth } from "@clerk/nextjs";
import { getAPIKeys, addNewAPIKey } from "@/server/curdApiKeys";
import jwt from "jsonwebtoken";

export async function getOrCreateApiKey() {
  const { userId, orgId } = auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }
  
  // Try to get existing API keys
  const apiKeys = await getAPIKeys();
  
  // If user has an API key, return the first one
  if (apiKeys && apiKeys.length > 0) {
    return apiKeys[0].key;
  }
  
  // If no API key exists, create a temporary one for this session
  // This is a temporary key that expires in 24 hours
  const expiresIn = 60 * 60 * 24; // 24 hours
  let token: string;

  if (orgId) {
    token = jwt.sign(
      { user_id: userId, org_id: orgId },
      process.env.JWT_SECRET!,
      { expiresIn }
    );
  } else {
    token = jwt.sign({ user_id: userId }, process.env.JWT_SECRET!, {
      expiresIn,
    });
  }

  return token;
}

