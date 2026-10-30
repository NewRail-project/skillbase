import { h } from "../../shared/dom.js";
import { generateQRSvg, generateQRDataUrl } from "../../shared/qr.js";
import { icons } from "../../shared/icons.js";

export default function AboutPage() {
  const page = h("div", { class: "page about-page" });

  const siteUrl = "https://newrail-project.github.io/skillbase/";

  const qrWrapper = h("div", {
    class: "qr-wrapper",
    style: "display: inline-block; background: white; padding: 1rem; border-radius: var(--radius); box-shadow: var(--shadow-sm); line-height: 0;"
  });
  // Явно задаем размеры для стабильного отображения на мобильных
  qrWrapper.innerHTML = generateQRSvg(siteUrl, { width: 280, height: 280, dark: "#000000", light: "#ffffff" });

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
          qrWrapper,
          h("div", { class: "btn-row", style: "justify-content: center; margin-top: 1rem;" },
            h("a", { class: "btn primary", href: siteUrl, target: "_blank", rel: "noopener" }, "Открыть Skillbase"),
            h("button", {
              class: "btn secondary",
              id: "download-qr-btn",
              style: "margin-left: 0.5rem;"
            }, "Скачать PNG")
          )
        )
      )
    )
  );

  page.appendChild(card);

  // Функция скачивания QR-кода как настоящего PNG через Canvas
  const downloadBtn = page.querySelector("#download-qr-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const svg = qrWrapper.querySelector("svg");
      if (!svg) return;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        // Увеличиваем размер для качественной печати (например, 1024x1024)
        const exportSize = 1024;
        canvas.width = exportSize;
        canvas.height = exportSize;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, exportSize, exportSize);
        ctx.drawImage(img, 0, 0, exportSize, exportSize);
        
        try {
          const pngUrl = canvas.toDataURL("image/png");
          const link = document.createElement("a");
          link.href = pngUrl;
          link.download = "skillbase-qr.png";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (err) {
          console.error("PNG export failed:", err);
          alert("Не удалось сохранить PNG. Попробуйте сделать скриншот.");
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        alert("Ошибка при подготовке изображения.");
      };
      img.src = url;
    });
  }

  return page;
}
}
