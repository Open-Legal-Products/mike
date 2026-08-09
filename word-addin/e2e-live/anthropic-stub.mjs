// Minimal Anthropic Messages API stand-in for driving the Mike stack when no
// funded API key is available. Speaks just enough of the streaming protocol
// for @anthropic-ai/sdk's messages.stream()/finalMessage() to work:
// message_start -> content_block_start -> content_block_delta* ->
// content_block_stop -> message_delta -> message_stop.
//
// The response exercises the add-in's tagged Word-edit contract
// (<original>/<replacement>/<reason>) when the Word-chat system prompt asks for
// exact source text. Other prompts receive a short document summary.
import http from "node:http";

const PORT = 4141;

function editBlock(original, replacement, reason) {
  return `<original>${original}</original>\n<replacement>${replacement}</replacement>\n<reason>${reason}</reason>`;
}

function pickResponse(body) {
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1];
  const text =
    typeof last?.content === "string"
      ? last.content
      : (last?.content ?? [])
          .map((block) => (typeof block === "string" ? block : block.text ?? ""))
          .join("\n");
  const systemText =
    typeof body.system === "string"
      ? body.system
      : (body.system ?? []).map((block) => block.text ?? "").join("\n");
  const promptText = `${systemText}\n${text}`;

  if (promptText.includes("character-for-character")) {
    return [
      editBlock(
        "The Suplier shall provide",
        "The Supplier shall provide",
        'Spelling — "Suplier" should be "Supplier".',
      ),
      editBlock(
        "within thirty (30) days of reciept",
        "within thirty (30) days of receipt",
        'Spelling — "reciept" should be "receipt".',
      ),
      "Both fixes preserve the clause numbering and meaning.",
    ].join("\n");
  }
  return "This is a services agreement between Acme Consulting Ltd and a consultant. It covers the services to be provided (clause 1), payment terms of thirty days (clause 2), termination on sixty days' notice (clause 3), the standard of work required (clause 4), and confidentiality between the parties (clause 5).";
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (!req.url.includes("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const reply = pickResponse(body);
    const model = body.model ?? "claude-sonnet-4-6";
    const id = `msg_stub_${Date.now()}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    sse(res, "message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    });
    sse(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });

    // Stream in word-ish chunks with small delays so the UI visibly streams.
    const chunks = reply.match(/.{1,24}/gs) ?? [];
    for (const chunk of chunks) {
      sse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });
      await new Promise((r) => setTimeout(r, 45));
    }

    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: Math.ceil(reply.length / 4) },
    });
    sse(res, "message_stop", { type: "message_stop" });
    res.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`anthropic stub listening on http://127.0.0.1:${PORT}`);
});
