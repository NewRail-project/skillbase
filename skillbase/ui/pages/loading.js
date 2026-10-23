import { h } from "../../shared/dom.js";
import { skeleton } from "../components/skeleton.js";

export default function LoadingComponent() {
  return h("div", { class: "card card-1" },
    h("div", { class: "skeleton" },
      skeleton(),
      skeleton(),
      skeleton()
    )
  );
}