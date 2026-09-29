import "./styles/app.css";
import { App, toast } from "./app";
import { showWindow } from "./backend";

new App().start().catch((e) => {
  console.error(e);
  toast(`Startup failed: ${e}`);
  void showWindow();
});
