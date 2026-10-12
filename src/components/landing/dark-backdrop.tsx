export function DarkBackdrop(props: { light: "right" | "center" }): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="landing-dots absolute inset-0" />
      <div
        className={`landing-light absolute ${props.light === "right" ? "inset-y-0 left-1/2 right-0" : "inset-0"}`}
      />
    </div>
  );
}
