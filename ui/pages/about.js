import { h } from "../../shared/dom.js";
import { generateQRSvg, generateQRDataUrl } from "../../shared/qr.js";
import { icons } from "../../shared/icons.js";

export default function AboutPage() {
  const page = h("div", { class: "page about-page" });

  const siteUrl = "https://newrail-project.github.io/skillbase/";

  const card = h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("div", { class: "eyebrow" }, "О платформе"),
      h("h1", {}, "Skillbase"),
      h("p", { class: "page-sub" }, "Современная цифровая платформа для обучения, проверки знаний и проведения live-занятий в железнодорожной отрасли.")
    ),
    h("div", { class: "panel-body" },
      h("div", { class: "about-grid" },
        h("div", {},
          h("h3", {}, "Для кого создана платформа"),
          h("p", {}, "Skillbase разработана специально для сотрудников депо, локомотивных бригад и студентов профильных учебных заведений и колледжей железнодорожного транспорта."),
          h("h3", { style: "margin-top: 1.5rem;" }, "Ключевые возможности"),
          h("ul", { class: "about-features" },
            h("li", {}, "Обучение: интерактивные материалы, конспекты и учебные задания с ограничением сроков."),
            h("li", {}, "Тестирование: проверка знаний с закрытыми ключами ответов и защитой от списывания."),
            h("li", {}, "Live-занятия: интерактивные комнаты в реальном времени с кодом входа, QR-кодом, таймерами вопросов и таблицей лидеров."),
            h("li", {}, "Аналитика: детальные результаты попыток, статистика прохождения и контроль успеваемости.")
          ),
          h("h3", { style: "margin-top: 1.5rem;" }, "Обучение и тестирование"),
          h("p", {}, "Платформа предлагает гибкую систему обучения: от теоретических материалов до практических тестов. Студенты могут проходить тесты с ограничением попыток, а преподаватели — видеть результаты и анализировать успеваемость."),
          h("h3", { style: "margin-top: 1.5rem;" }, "Live-занятия"),
          h("p", {}, "Интерактивные live-комнаты позволяют проводить тестирования в реальном времени. Ведущий задает вопросы, участники отвечают, а результаты отображаются на экране. Система поддерживает QR-код для быстрого входа, таймеры вопросов и таблицу лидеров.")
        ),
        h("div", { class: "room-qr-container", style: "text-align: center; margin-top: 1rem; padding: 1.5rem; background: var(--surface-2); border-radius: var(--radius-lg); border: 1px solid var(--border-color);" },
          h("h3", {}, "Официальный сайт проекта"),
          h("p", { class: "muted", style: "margin-bottom: 1rem;" }, "Отсканируйте камерой телефона для перехода на основной сайт Skillbase:"),
          h("div", {
            class: "qr-wrapper",
            innerHTML: generateQRSvg(siteUrl, { size: 200 })
          }),
          h("div", { class: "btn-row", style: "justify-content: center; margin-top: 1rem;" },
            h("a", { class: "btn primary", href: siteUrl, target: "_blank", rel: "noopener" }, "Открыть Skillbase"),
            h("button", { 
              class: "btn secondary", 
              onclick: "downloadQR()", 
              style: "margin-left: 0.5rem;" 
            }, "Скачать QR")
          )
        )
      )
    )
  );

  page.appendChild(card);
  
  // Функция скачивания QR-кода
  window.downloadQR = async function() {
    try {
      const dataUrl = await generateQRDataUrl(siteUrl, { size: 400 });
      if (!dataUrl) {
        alert("Не удалось сгенерировать QR-код для скачивания");
        return;
      }
      
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = "skillbase-qr.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Ошибка скачивания QR-кода:", error);
      alert("Не удалось скачать QR-код");
    }
  };
  
  return page;
}
