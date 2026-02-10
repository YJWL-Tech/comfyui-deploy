/**
 * 命令行修改用户密码（与注册时相同的 bcrypt 方式）
 * 用法: bun run scripts/change-password.ts <用户名> <新密码>
 * 需要先加载 .env（POSTGRES_URL），例如在 web 目录下执行。
 */
import { config } from "dotenv";

// 加载 .env，优先 .local.env（与 migrate 一致）
config({ path: ".local.env" });
config({ path: ".env" });

import { db } from "../src/db/db";
import { usersTable } from "../src/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const [username, newPassword] = process.argv.slice(2);

if (!username || !newPassword) {
  console.error("用法: bun run scripts/change-password.ts <用户名> <新密码>");
  process.exit(1);
}

if (newPassword.length < 6) {
  console.error("密码长度至少 6 个字符");
  process.exit(1);
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error("未设置 POSTGRES_URL，请确保 .env 或 .local.env 存在并包含 POSTGRES_URL");
    process.exit(1);
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.username, username),
    columns: { id: true, username: true },
  });

  if (!user) {
    console.error(`用户不存在: ${username}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({ password_hash: passwordHash, updated_at: new Date() })
    .where(eq(usersTable.id, user.id));

  console.log(`已更新用户 "${username}" 的密码。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
