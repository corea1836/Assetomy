export function Wordmark({
  tone = "default",
}: {
  tone?: "default" | "onDark";
}): React.JSX.Element {
  return (
    <span
      className={`text-[22px] font-medium leading-none tracking-[-0.02em] ${tone === "onDark" ? "text-white" : "text-primary"}`}
    >
      assetomy
    </span>
  );
}
