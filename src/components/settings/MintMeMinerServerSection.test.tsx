import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MintMeMinerServerSection } from "./MintMeMinerServerSection";
import type { PersonalServer } from "@/lib/storage/providers/personalServerStore";

const server = (url: string): PersonalServer => ({
  id: "s1", name: "Home", kind: "https-blob", url, scope: "private", capBytes: 1, usedBytes: 0, paused: false, createdAt: 0,
});

describe("MintMe miner in Personal Servers", () => {
  beforeEach(() => localStorage.clear());

  it("renders nothing without a personal server", () => {
    const { container } = render(<MintMeMinerServerSection servers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts off and shows the bridge for the attached server", () => {
    render(<MintMeMinerServerSection servers={[server("https://files.example.org")]} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/wss:\/\/files\.example\.org\/mintme-bridge/)).toBeInTheDocument();
  });

  it("cannot be turned on for a local server", () => {
    render(<MintMeMinerServerSection servers={[server("http://localhost:8787")]} />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
