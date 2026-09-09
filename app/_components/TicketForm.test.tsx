import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TicketForm from "./TicketForm";
import userEvent from "@testing-library/user-event";
import { uploadToR2, type UploadedAttachment } from "./upload";

vi.mock("./upload", () => ({
  uploadToR2: vi.fn(),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const uploadMock = vi.mocked(uploadToR2);

const ATTACHMENT: UploadedAttachment = {
  name: "receipt.jpg",
  kind: "IMAGE",
  contentType: "image/jpeg",
  sizeBytes: 42_000,
  r2Key: "tickets/draft/uuid-receipt.jpg",
};

function makeFile(name = "receipt.jpg", type = "image/jpeg", size?: number) {
  const file = new File(["file-bytes"], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

function pickFiles(...files: File[]) {
  fireEvent.change(fileInput(), { target: { files } });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Client dinner" } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1250" } });
  fireEvent.change(screen.getByLabelText("Deal name"), { target: { value: "50,000 sqft — Bhiwandi, Mumbai" } });
  fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Delhivery Supply Chain Pvt Ltd" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Dinner with client" } });
}

function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  uploadMock.mockReset();
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    if ((url === "/api/tickets" && init?.method === "POST") || (String(url).startsWith("/api/tickets/") && init?.method === "PATCH")) return Response.json({});
    throw new Error(`Unexpected request: ${init?.method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TicketForm attachments", () => {
  it.each(["Title", "Amount (₹)", "Deal name", "Client name", "Description"])("requires %s through normal browser submission", async (label) => {
    const user = userEvent.setup(); render(<TicketForm />); fillRequiredFields();
    const input = screen.getByLabelText(label); expect(input).toBeRequired();
    await user.clear(input); await user.click(screen.getByRole("button", { name: "Submit ticket" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("submits selected date/category and trimmed client/deal through a user click", async () => {
    const user = userEvent.setup(); render(<TicketForm />); fillRequiredFields();
    await user.selectOptions(screen.getByLabelText("Category"), "Meals");
    fireEvent.change(screen.getByLabelText(/Expense occurrence date/), { target: { value: "2026-09-09" } });
    fireEvent.change(screen.getByLabelText("Deal name"), { target: { value: " Deal " } });
    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: " Client " } });
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));
    await screen.findByText(/Ticket submitted/);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ category: "Meals", expenseDate: "2026-09-09", dealName: "Deal", clientName: "Client" });
  });
  it.each(["create", "edit"] as const)("navigates and refreshes after successful %s, only after the delay", async (mode) => {
    vi.useFakeTimers(); render(<TicketForm mode={mode} ticketId={mode === "edit" ? "RB-99" : undefined} />); fillRequiredFields();
    await act(async () => submitForm());
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(499); }); expect(router.push).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(router.push).toHaveBeenCalledExactlyOnceWith(mode === "edit" ? "/dashboard/tickets/RB-99" : "/dashboard"); expect(router.refresh).toHaveBeenCalledOnce();
  });
  it("does not navigate after the form unmounts", async () => {
    vi.useFakeTimers(); const { unmount } = render(<TicketForm />); fillRequiredFields();
    await act(async () => submitForm()); unmount(); await vi.runAllTimersAsync(); expect(router.push).not.toHaveBeenCalled();
  });
  it.each([400, 401, 409, 500])("shows API %s, preserves values and permits retry", async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Please try again" }, { status }));
    render(<TicketForm />); fillRequiredFields(); submitForm(); await screen.findByText("Please try again");
    expect(screen.getByLabelText("Title")).toHaveValue("Client dinner"); expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit ticket" })).toBeEnabled(); submitForm(); await screen.findByText(/Ticket submitted/);
  });
  it.each(["create", "edit"] as const)("handles non-JSON API errors in %s mode", async (mode) => {
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    render(<TicketForm mode={mode} ticketId="RB-99" />); fillRequiredFields(); submitForm();
    await screen.findByText(mode === "edit" ? "Save failed (502)" : "Submit failed (502)"); expect(router.refresh).not.toHaveBeenCalled();
  });
  it("handles a network failure and blocks duplicate submits while a request is pending", async () => {
    let fail!: (reason: Error) => void; fetchMock.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    render(<TicketForm />); fillRequiredFields(); submitForm(); submitForm();
    expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => fail(new Error("offline"))); expect(screen.getByText("offline")).toBeInTheDocument();
  });
  it("prefills edit mode and sends additions/removals with the PATCH contract", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT);
    render(<TicketForm mode="edit" ticketId="RB-99" initial={{ title: "Existing", category: "Meals", amount: "50.25", description: "Details", expenseDate: "2026-09-08", dealName: "Deal", clientName: "Client", existingAttachments: [{ id: "old-1", name: "old.pdf", sizeLabel: "1 KB" }, { id: "keep-2", name: "keep.pdf", sizeLabel: "2 KB" }] }} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Existing"); expect(screen.getByLabelText("Amount (₹)")).toHaveValue(50.25);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]); pickFiles(makeFile()); await screen.findByText(/uploaded/); submitForm(); await screen.findByText(/Ticket updated/);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/RB-99"); expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ title: "Existing", category: "Meals", amount: 50.25, description: "Details", expenseDate: "2026-09-08", dealName: "Deal", clientName: "Client", addAttachments: [ATTACHMENT], removeAttachmentIds: ["old-1"] });
    expect(uploadMock).toHaveBeenCalledOnce(); expect(screen.getByText("keep.pdf")).toBeInTheDocument();
  });
  it("accepts the exact 25 MiB limit and rejects one byte over", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT); render(<TicketForm />);
    pickFiles(makeFile("exact.jpg", "image/jpeg", 25 * 1024 * 1024), makeFile("over.jpg", "image/jpeg", 25 * 1024 * 1024 + 1));
    await screen.findByText(/uploaded/); expect(uploadMock).toHaveBeenCalledOnce(); expect(screen.getByText(/larger than 25 MB/)).toBeInTheDocument();
  });
  it("handles concurrent uploads completing out of order and duplicates in a batch", async () => {
    const finish = new Map<string, (attachment: UploadedAttachment) => void>();
    uploadMock.mockImplementation((file) => new Promise((resolve) => finish.set(file.name, resolve)));
    render(<TicketForm />); const first = makeFile("first.jpg"); pickFiles(first, first, makeFile("second.jpg"));
    expect(uploadMock).toHaveBeenCalledTimes(2); fillRequiredFields(); submitForm(); await screen.findByText(/still uploading/); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => finish.get("second.jpg")!({ ...ATTACHMENT, name: "second.jpg", r2Key: "second" }));
    expect(screen.getByRole("button", { name: "Uploading attachments…" })).toBeDisabled();
    await act(async () => finish.get("first.jpg")!({ ...ATTACHMENT, name: "first.jpg", r2Key: "first" }));
    submitForm(); await screen.findByText(/Ticket submitted/);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).attachments.map((a: UploadedAttachment) => a.r2Key)).toEqual(["first", "second"]);
  });
  it("ignores late completion after removing an in-flight upload", async () => {
    let finish!: (attachment: UploadedAttachment) => void; uploadMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<TicketForm />); pickFiles(makeFile()); fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await act(async () => finish(ATTACHMENT)); expect(screen.queryByText("receipt.jpg")).not.toBeInTheDocument();
    fillRequiredFields(); submitForm(); await screen.findByText(/Ticket submitted/); expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).attachments).toEqual([]);
  });
  it("supports drag/drop and distinguishes same-name files with different sizes", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT); render(<TicketForm />);
    const zone = screen.getByText("Drop files here or tap to browse").closest("label")!;
    fireEvent.dragOver(zone); expect(zone).toHaveClass("is-drag"); fireEvent.dragLeave(zone); expect(zone).not.toHaveClass("is-drag");
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile("a.jpg", "image/jpeg", 10), makeFile("a.jpg", "image/jpeg", 20)] } });
    await act(async () => {}); expect(uploadMock).toHaveBeenCalledTimes(2); expect(zone).not.toHaveClass("is-drag");
  });
  it.each(["create", "edit"] as const)("cancels %s without a request", (mode) => {
    render(<TicketForm mode={mode} ticketId="RB-99" />); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(router.push).toHaveBeenCalledWith(mode === "edit" ? "/dashboard/tickets/RB-99" : "/dashboard"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uploads immediately on selection and shows progress until done", async () => {
    let resolveUpload!: (a: UploadedAttachment) => void;
    let reportProgress!: (pct: number) => void;
    uploadMock.mockImplementation((_file, _hint, onProgress) => {
      reportProgress = onProgress;
      return new Promise((resolve) => {
        resolveUpload = resolve;
      });
    });

    render(<TicketForm />);
    pickFiles(makeFile());

    // Upload starts on selection, not on submit
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), "draft", expect.any(Function));
    expect(screen.getByText("Uploading… 0%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uploading attachments…" })).toBeDisabled();

    act(() => reportProgress(57));
    expect(screen.getByText("Uploading… 57%")).toBeInTheDocument();

    await act(async () => resolveUpload(ATTACHMENT));
    expect(screen.getByText(/uploaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit ticket" })).toBeEnabled();
  });

  it("shows the error with a Retry button when an upload fails, and retries on demand", async () => {
    uploadMock.mockRejectedValueOnce(new Error("upload timed out")).mockResolvedValueOnce(ATTACHMENT);

    render(<TicketForm />);
    pickFiles(makeFile());

    expect(await screen.findByText("upload timed out")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/uploaded/)).toBeInTheDocument();
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("submits attachment metadata without re-uploading", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT);

    render(<TicketForm />);
    pickFiles(makeFile());
    await screen.findByText(/uploaded/);

    fillRequiredFields();
    submitForm();

    await screen.findByText(/Ticket submitted/);
    expect(uploadMock).toHaveBeenCalledTimes(1); // never re-uploaded at submit time

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tickets");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.attachments).toEqual([ATTACHMENT]);
    expect(body.title).toBe("Client dinner");
    expect(body.amount).toBe(1250);
    expect(body.category).toBe("Travel");
    expect(body.description).toBe("Dinner with client");
    expect(body.expenseDate).toBeNull();
    expect(body.dealName).toBe("50,000 sqft — Bhiwandi, Mumbai");
    expect(body.clientName).toBe("Delhivery Supply Chain Pvt Ltd");
  });

  it("blocks submission while an attachment has failed", async () => {
    uploadMock.mockRejectedValue(new Error("network error during upload"));

    render(<TicketForm />);
    pickFiles(makeFile());
    await screen.findByText("network error during upload");

    fillRequiredFields();
    submitForm();

    expect(
      await screen.findByText(/Some attachments failed to upload/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversize files without attempting an upload", () => {
    render(<TicketForm />);
    pickFiles(makeFile("huge.jpg", "image/jpeg", 26 * 1024 * 1024));

    expect(screen.getByText(/larger than 25 MB/)).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("ignores duplicate selections of the same file", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT);

    render(<TicketForm />);
    pickFiles(makeFile());
    await screen.findByText(/uploaded/);
    pickFiles(makeFile());

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("removing a failed attachment clears the submit blocker", async () => {
    uploadMock.mockRejectedValue(new Error("upload timed out"));

    render(<TicketForm />);
    pickFiles(makeFile());
    await screen.findByText("upload timed out");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    fillRequiredFields();
    submitForm();
    await screen.findByText(/Ticket submitted/);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual([]);
  });

  it("uses the ticket id as the R2 key hint in edit mode", async () => {
    uploadMock.mockResolvedValue(ATTACHMENT);

    render(<TicketForm mode="edit" ticketId="tkt-99" />);
    pickFiles(makeFile());
    await screen.findByText(/uploaded/);

    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), "tkt-99", expect.any(Function));
  });
});
