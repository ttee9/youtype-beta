import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country");

  if (country && country !== "US") {
    return NextResponse.redirect(new URL("/not-available", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /not-available (to avoid redirect loops)
     * - _next/static, _next/image, favicon.ico (Next.js internals)
     */
    "/((?!not-available|_next/static|_next/image|favicon.ico).*)",
  ],
};
