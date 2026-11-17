"use client";
import { useEffect } from "react";
import { rememberSrc } from "../lib/track";

// Records a ?src= campaign tag from whichever page a visitor lands on (see lib/track.ts).
export function SrcCapture() {
  useEffect(() => {
    rememberSrc();
  }, []);
  return null;
}
