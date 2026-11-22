// Smoke test: the Tunnel view renders, builds its engine and hands it boxes for every span without throwing
// (a variable used before it was declared broke the page once, 2026-11-21). WebGL is not here: the engine is a stub.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Task } from "@/core/tasks";
import { localDay } from "@/hooks/useGoogleEvents";
import { Scale } from "./tunnel/scale";
import type { PassageEvents, TunnelBox } from "./tunnel/passage";

const boxes: TunnelBox[] = [];
let engineEvents: PassageEvents | null = null; // the last engine's hooks back into the view
vi.mock("./tunnel/passage", () => ({
  Passage: class {
    span = "year";
    constructor(_host: HTMLElement, events: PassageEvents, opts: { today: number }) {
      engineEvents = events;
      for (const span of ["day", "month", "year"] as const) boxes.push(events.getBox(new Scale(span, opts.today), 0));
      // as the real engine does once it moves: a new range of days → the page renders again with the engine there
      setTimeout(() => events.onRange(opts.today - 400, opts.today + 400));
    }
    setPaused() {}
    setHeld() {}
    setGallery() {}
    refresh() {}
    dispose() {}
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/features/items/ItemDrawer", () => ({ useItemDrawer: () => ({ id: null, fresh: false, open: () => undefined }) }));
vi.mock("@/hooks/useVault", () => ({ useVault: () => ({ files: [], resolve: () => null }) }));

const { default: TunnelCalendar } = await import("./TunnelCalendar");

// the local day, as the view counts it (the UTC one is yesterday just after local midnight east of Greenwich)
const today = localDay(new Date());
const task = (over: Partial<Task>): Task => ({
  id: "t1", title: "Write the lesson", description: "", estimatedTime: 60, status: "idle", startTime: null, endTime: null,
  date: today, deadline: "", position: 0, link: "", priority: "medium", time: "09:00", ...over,
});

describe("TunnelCalendar", () => {
  it("renders and gives the engine a box for every span", async () => {
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const tasks = [task({}), task({ id: "t2", title: "Long one", time: null, deadline: "2099-01-01" })];
    localStorage.setItem("tunnel.span", "year"); // the span the owner had open when it broke
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let view: ReturnType<typeof render> | null = null;
    await act(async () => {
      view = render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <TooltipProvider>
              <TunnelCalendar tasks={tasks} byId={new Map()} onOpenDay={() => {}} onAddTask={async () => undefined} />
            </TooltipProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50)); // the engine's first range → the second render
    });
    // still on screen after the second render (a render error unmounts it) and nothing reported
    expect(view!.container.querySelector('[aria-roledescription="tunnel"]')).not.toBeNull();
    expect(errors.mock.calls.filter((c) => !String(c[0]).includes("act("))).toEqual([]);
    errors.mockRestore();
    expect(boxes.map((b) => b.days.length)).toEqual([1, expect.any(Number), expect.any(Number)]);
    expect(boxes[0].days[0].tasks.map((t) => t.title)).toContain("Write the lesson");
    expect(boxes[0].long.map((l) => l.task.title)).toEqual(["Long one"]);
  });

  it("an empty cell asks for a name; nothing is made without one (#204)", async () => {
    const add = vi.fn(async (_t: { title: string; date: string; time: string | null }) => ({ id: "new" }));
    await act(async () => {
      render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <TooltipProvider>
              <TunnelCalendar tasks={[]} byId={new Map()} onOpenDay={() => {}} onAddTask={add} />
            </TooltipProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 20)); // the engine is made once the fonts are ready
    });
    const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
    act(() => engineEvents!.onEmpty({ day, minutes: 600, x: 40, y: 40 }));
    const input = screen.getByPlaceholderText("Task name");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(add).not.toHaveBeenCalled(); // no name, no task
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Task name")).toBeNull(); // closed: still nothing made
    expect(add).not.toHaveBeenCalled();

    act(() => engineEvents!.onEmpty({ day, minutes: 600, x: 40, y: 40 }));
    fireEvent.change(screen.getByPlaceholderText("Task name"), { target: { value: "  Write the plan  " } });
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Task name"), { key: "Enter" });
    });
    expect(add).toHaveBeenCalledWith({ title: "Write the plan", date: today, time: "10:00" });
    expect(screen.queryByPlaceholderText("Task name")).toBeNull();
  });
});
