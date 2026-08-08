import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TicketForm from "./TicketForm";
import { uploadToR2, type UploadedAttachment } from "./upload";

vi.mock("./upload", () => ({
  uploadToR2: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TicketForm attachments", () => {
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
    const body = JSON.parse(init.body as string);
    expect(body.attachments).toEqual([ATTACHMENT]);
    expect(body.title).toBe("Client dinner");
    expect(body.amount).toBe(1250);
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
