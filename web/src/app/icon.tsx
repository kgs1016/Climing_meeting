import { ImageResponse } from "next/og";

/* 브라우저 탭 파비콘 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0e0d",
          color: "#ff5a45",
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        H
      </div>
    ),
    { ...size }
  );
}
