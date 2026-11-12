import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { icons } from "../../shared/icons.js";

export default async function AnalyticsPage() {
  const page = h("div", { class: "page" });
  page.appendChild(h("h1", {}, "Аналитика"));

  const attempts = await listOrgAttempts(State.profile.orgId);
  const completed = attempts.filter(a => a.status === "graded" && a.topicId);

  const topicMap = new Map();
  completed.forEach(a => {
    if (!topicMap.has(a.topicId)) topicMap.set(a.topicId, { scoreSum: 0, count: 0, title: a.topicId });
    const t = topicMap.get(a.topicId);
    t.scoreSum += a.percent;
    t.count += 1;
  });

  const weakTopics = Array.from(topicMap.entries())
    .map(([id, data]) => ({ id, avg: Math.round(data.scoreSum / data.count), count: data.count }))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 5);

  const block = h("section", { class: "panel" });
  block.appendChild(h("h2", {}, "Слабые темы группы"));

  if (!weakTopics.length) {
    block.appendChild(h("p", { class: "muted" }, "Недостаточно данных."));
  } else {
    const list = h("div", { class: "list" });
    weakTopics.forEach(t => {
      list.appendChild(h("div", { class: "list-row" },
        h("div", { class: "list-row-title" }, t.id),
        h("div", { class: "badge badge-warning" }, `${t.avg}%`)
      ));
    });
    block.appendChild(list);
  }

  page.appendChild(block);
  return page;
}
