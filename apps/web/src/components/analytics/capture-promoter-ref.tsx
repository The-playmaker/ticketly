"use client";

import { useEffect } from "react";
import {
  readRefFromSearchParams,
  setPromoterRefCookie,
} from "@/lib/promoter";

/**
 * Captures `?ref=` / `?promo=` into a cookie + sessionStorage for checkout attribution.
 * Non-blocking: invalid/missing refs are ignored.
 */
export function CapturePromoterRef() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = readRefFromSearchParams(params);
      if (code) setPromoterRefCookie(code);
    } catch {
      /* ignore */
    }
  }, []);

  return null;
}
