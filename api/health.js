// /api/health.js
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    ok: true,
    service: "garnett-work-web",
    ts: new Date().toISOString(),
  });
}
