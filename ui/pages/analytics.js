import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { getTopics } from "../../core/subjects.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";
import { icons } from "../../shared/icons.js";

export default async function AnalyticsPage() {
  const page = h("div", { class: "page" });
  page.appendChild(h("h1", {}, "Аналитика"));

  const body = h("div", {});
  page.appendChild(body);

  async function load() {
    body.replaceChildren(loading());
    try {
      // Названия тем берём из справочника — сырые topicId ученику не понятны.
      const [attempts, topics] = await Promise.all([
        listOrgAttempts(State.profile.orgId),
        getTopics()
      ]);
      const topicTitle = new Map(topics.map(t => [t.id, t.title || t.id]));
      const completed = attempts.filter(a => a.status === "graded" && a.topicId);

      const topicMap = new Map();
      completed.forEach(a => {
        if (!topicMap.has(a.topicId)) topicMap.set(a.topicId, { scoreSum: 0, count: 0, title: topicTitle.get(a.topicId) || a.topicId });
        const t = topicMap.get(a.topicId);
        t.scoreSum += a.percent;
        t.count += 1;
      });

      const weakTopics = Array.from(topicMap.entries())
        .map(([id, data]) => ({ id, title: data.title, avg: Math.round(data.scoreSum / data.count), count: data.count }))
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 5);

      const block = h("section", { class: "panel" });
      block.appendChild(h("h2", {}, "Слабые темы"));

      if (!weakTopics.length) {
        block.appendChild(h("p", { class: "muted" }, "Недостаточно данных."));
      } else {
        const list = h("div", { class: "list" });
        weakTopics.forEach(t => {
          list.appendChild(h("div", { class: "list-row" },
            h("div", { class: "list-row-title" }, t.title),
            h("div", { class: "badge badge-warning" }, `${t.avg}%`)
          ));
        });
        block.appendChild(list);
      }

      body.replaceChildren(block);
    } catch (err) {
      console.error("Аналитика:", err);
      body.replaceChildren(errorState({
        text: "Не удалось загрузить аналитику. Проверьте подключение к сети.",
        onRetry: load // повтор без перезагрузки страницы
      }));
    }
  }

  await load();
  return page;
}
