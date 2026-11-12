import { h } from "../../shared/dom.js";
import { generateQRSvg, generateQRDataUrl } from "../../shared/qr.js";
import { icons } from "../../shared/icons.js";

export default function AboutPage() {
  const page = h("div", { class: "page about-page" });

  const siteUrl = "https://newrail-project.github.io/skillbase/";

  // Настройки QR-кода: фирменные цвета Skillbase
  const qrOptions = {
    width: 280,
    height: 280,
    ecc: "H",
    rounded: true,
    dark: "#172817",        // тёмно-зелёные модули
    light: "#F5F7ED",       // светлый фон QR
    finderDark: "#101810"   // ещё более тёмные маркеры
  };

  const qrWrapper = h("div", {
    class: "qr-wrapper",
    style: "display: inline-block; background: #F5F7ED; padding: 1.25rem; border-radius: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); line-height: 0; border: 2px solid #C5E747;"
  });
  qrWrapper.innerHTML = generateQRSvg(siteUrl, qrOptions);

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
        h("div", {
          class: "brand-qr-card",
          style: "text-align: center; margin-top: 1rem; padding: 2.5rem 1.5rem; background: linear-gradient(135deg, #101810 0%, #0a0f0a 100%); color: #fff; border-radius: 2rem; border: 1px solid #C5E747; box-shadow: var(--shadow-lg); position: relative; overflow: hidden;"
        },
          h("div", {
            style: "position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, #C5E747, transparent);"
          }),
          h("div", { style: "margin-bottom: 1.5rem; position: relative;" },
            h("div", { style: "font-family: var(--font-brand); font-weight: 800; font-size: 1.5rem; letter-spacing: 0.1em; color: #C5E747; text-shadow: 0 0 10px rgba(197, 231, 71, 0.3);" }, "SKILLBASE"),
            h("div", { style: "font-size: 0.8rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem;" }, "Официальная платформа")
          ),
          qrWrapper,
          h("p", { style: "margin: 1.5rem 0; font-size: 0.95rem; opacity: 0.9; position: relative;" }, "Отсканируйте, чтобы открыть платформу"),
          h("div", { class: "btn-row", style: "justify-content: center; gap: 0.75rem; position: relative;" },
            h("a", {
              class: "btn",
              href: siteUrl,
              target: "_blank",
              rel: "noopener",
              style: "background: #C5E747; color: #101810; border: none; font-weight: 600; padding: 0.75rem 1.5rem;"
            }, "Открыть сайт"),
            h("button", {
              class: "btn",
              id: "download-qr-btn",
              style: "background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px);"
            }, "PNG")
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
        // Фон карточки: светлый цвет QR, чтобы сохранить дизайн при скачивании
        ctx.fillStyle = "#F5F7ED";
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
