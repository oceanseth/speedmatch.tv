import { publicText } from "../../../../lib/public-replays";
import { ImageResponse } from "next/og";
import { getPublicReplay } from "../../../../lib/public-tournaments";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ tournamentId: string }> }) {
  let show;
  try { show = await getPublicReplay((await params).tournamentId); }
  catch { return new Response("Recap unavailable", { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (!show) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const headline = publicText(show.summaryTitle, "A match worth watching");
  const winnerName = publicText(show.winner?.name ?? "", "No winner recorded", 120);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(125deg, #0b0616 25%, #29133f 100%)", color: "#faf8ff", padding: "52px 64px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Same opposing-play geometry and colors as app/icon.svg. */}
        <svg width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b0616" /><path d="M10 15c0-3 3-4 5-2l12 16c2 2 2 4 0 6L15 51c-2 2-5 1-5-2Z" fill="#ff5da2" /><path d="M54 15c0-3-3-4-5-2L37 29c-2 2-2 4 0 6l12 16c2 2 5 1 5-2Z" fill="#b08aff" /></svg>
        <div style={{ display: "flex", alignItems: "center", fontSize: 38, fontWeight: 700, letterSpacing: -2 }}>speed<span style={{ color: "#ff5da2" }}>match</span><span style={{ marginLeft: 12, border: "1px solid #65506e", borderRadius: 8, padding: "3px 10px", fontSize: 25, letterSpacing: 0 }}>.tv</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 18, letterSpacing: 4, textTransform: "uppercase", color: "#b08aff" }}>{show.category} / Tournament recap</div>
        <div style={{ display: "flex", fontSize: headline.length > 95 ? 44 : 58, fontWeight: 700, lineHeight: 1.1, wordBreak: "break-word", width: 1072 }}>{headline}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 28, borderTop: "1px solid #4c345a", paddingTop: 25 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 740, flexShrink: 0 }}><span style={{ color: "#ff5da2", fontSize: 16, letterSpacing: 3 }}>THE WINNING MATCH</span><span style={{ fontSize: 28, wordBreak: "break-word" }}>{winnerName}</span></div>
        <span style={{ color: "#c4b5ce", fontSize: 20 }}>15 seconds. One choice.</span>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "Cache-Control": "no-store" } },
  );
}
