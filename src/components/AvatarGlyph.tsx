import type { Avatar } from "../lib/types";

// Same three-kind rendering as LiveShowcase so image/stream personas
// never fall through to a blank space. Shared by My Matches, the stage
// surface, and the public watch pages.
export default function AvatarGlyph({
  avatar,
  size,
}: {
  avatar: Avatar;
  size: number;
}) {
  return (
    <>
      {avatar.kind === "emoji" && avatar.value}
      {avatar.kind === "image" && (
        // Hosts must be allowlisted server-side before user-supplied
        // URLs reach this page (viewer-IP beacon otherwise).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar.value}
          alt=""
          className="inline-block rounded-md object-cover align-text-bottom"
          style={{ height: size, width: size }}
        />
      )}
      {avatar.kind === "stream" && <span>🎥</span>}
    </>
  );
}
