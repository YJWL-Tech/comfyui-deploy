"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/workflows";
  const error = searchParams.get("error");

  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isLogin) {
        // 登录
        const result = await signIn("credentials", {
          username: formData.username,
          password: formData.password,
          redirect: false,
        });

        if (result?.error) {
          toast.error(result.error);
        } else {
          toast.success("登录成功");
          router.push(callbackUrl);
          router.refresh();
        }
      } else {
        // 注册
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
            name: formData.name,
            email: formData.email,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          toast.error(data.error || "注册失败");
        } else {
          toast.success("注册成功，正在登录...");
          // 自动登录
          const result = await signIn("credentials", {
            username: formData.username,
            password: formData.password,
            redirect: false,
          });

          if (result?.error) {
            toast.error("自动登录失败，请手动登录");
            setIsLogin(true);
          } else {
            router.push(callbackUrl);
            router.refresh();
          }
        }
      }
    } catch (err) {
      toast.error("操作失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl border border-slate-200">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-800">
          {isLogin ? "登录" : "注册"}
        </h1>
        <p className="text-slate-500 mt-2">
          ComfyUI Deploy 管理平台
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error === "CredentialsSignin"
            ? "用户名或密码错误"
            : "登录失败，请重试"}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">用户名</Label>
          <Input
            id="username"
            type="text"
            placeholder="请输入用户名"
            value={formData.username}
            onChange={(e) =>
              setFormData({ ...formData, username: e.target.value })
            }
            required
            autoComplete="username"
          />
        </div>

        {!isLogin && (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">姓名</Label>
              <Input
                id="name"
                type="text"
                placeholder="请输入姓名"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required={!isLogin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱（可选）</Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入邮箱"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="请输入密码"
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            required
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? "处理中..." : isLogin ? "登录" : "注册"}
        </Button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setFormData({ username: "", password: "", name: "", email: "" });
          }}
          className="text-blue-600 hover:text-blue-700 text-sm hover:underline"
        >
          {isLogin ? "没有账号？点击注册" : "已有账号？点击登录"}
        </button>
      </div>
    </div>
  );
}

function LoginLoading() {
  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl border border-slate-200">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-800">登录</h1>
        <p className="text-slate-500 mt-2">加载中...</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <Suspense fallback={<LoginLoading />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
