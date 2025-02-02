import {
  NextFetchEvent,
  NextRequest,
  NextResponse,
  userAgent,
} from "next/server";
import { detectBot, getFinalUrl, parse } from "#/lib/middleware/utils";
import { redis } from "#/lib/upstash";
import { recordClick } from "#/lib/tinybird";
import { DUB_HEADERS } from "../constants";

export default async function LinkMiddleware(
  req: NextRequest,
  ev: NextFetchEvent,
) {
  const { domain, fullKey: key } = parse(req);

  if (!domain || !key) {
    return NextResponse.next();
  }

  const response = await redis.get<{
    url: string;
    password?: boolean;
    proxy?: boolean;
    rewrite?: boolean;
    ios?: string;
    android?: string;
  }>(`${domain}:${key}`);
  const {
    url: target,
    password,
    proxy,
    rewrite,
    ios,
    android,
  } = response || {};

  if (target) {
    // special case for link health monitoring with planetfall.io :)
    if (!req.headers.get("dub-no-track")) {
      ev.waitUntil(recordClick(domain, req, key)); // track the click only if there is no `dub-no-track` header
    }

    if (password) {
      // rewrite to auth page (/protected/[domain]/[key]) if the link is password protected
      return NextResponse.rewrite(
        new URL(`/protected/${domain}/${key}`, req.url),
      );
    }

    const isBot = detectBot(req);
    if (isBot && proxy) {
      // rewrite to proxy page (/_proxy/[domain]/[key]) if it's a bot
      return NextResponse.rewrite(new URL(`/proxy/${domain}/${key}`, req.url));
    } else if (ios && userAgent(req).os?.name === "iOS") {
      // redirect to iOS link if it is specified and the user is on an iOS device
      return NextResponse.redirect(getFinalUrl(ios, { req }), DUB_HEADERS);
    } else if (android && userAgent(req).os?.name === "Android") {
      // redirect to Android link if it is specified and the user is on an Android device
      return NextResponse.redirect(getFinalUrl(android, { req }), DUB_HEADERS);
    } else {
      // regular redirect
      return rewrite
        ? NextResponse.rewrite(getFinalUrl(target, { req }), DUB_HEADERS)
        : NextResponse.redirect(getFinalUrl(target, { req }), DUB_HEADERS);
    }
  } else {
    // short link not found, redirect to root
    return NextResponse.redirect(new URL("/", req.url), DUB_HEADERS);
  }
}
