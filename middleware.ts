import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

const protectedPrefixes = [
  "/feed",
  "/avatar",
  "/create",
  "/messages",
  "/profile",
  "/users",
  "/search",
  "/onboarding"
];

export function middleware(request: NextRequest) {
  const isProtected = protectedPrefixes.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/feed/:path*", "/avatar/:path*", "/create/:path*", "/messages/:path*", "/profile/:path*", "/users/:path*", "/search/:path*", "/onboarding"]
};
