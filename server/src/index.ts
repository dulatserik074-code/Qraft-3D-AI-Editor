import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8790);
createApp().listen(port, "0.0.0.0", () =>
  process.stdout.write(`Qraft server: http://localhost:${port}\n`),
);
