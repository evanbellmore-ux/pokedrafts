import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
console.log(runtime.catalog.items.map((item) => item.id).filter((id) => !id.endsWith("ite") && !id.includes("itex") && !id.includes("itey")).join(" "));
