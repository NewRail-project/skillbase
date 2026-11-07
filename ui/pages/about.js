import { h } from "../../shared/dom.js";
import { generateQRSvg, generateQRDataUrl } from "../../shared/qr.js";
import { icons } from "../../shared/icons.js";
import { themedQrOptions, qrPalette } from "../../shared/qr-theme.js";
import { subscribeTheme, subscribeSkin } from "../../shared/theme.js";

export default function AboutPage() {
  const page = h("div", { class: "page about-page" });

  const siteUrl = "https://newrail-project.github.io/skillbase/";

  // QR берёт цвета из текущей темы и скина и перерисовывается при их смене.
  const qrWrapper = h("div", { class: "qr-wrapper qr-frame" });
  const paintQr = () => {
    const pal = qrPalette();
    qrWrapper.style.background = pal.light;
    qrWrapper.innerHTML = generateQRSvg(siteUrl, themedQrOptions({
      width: 280, height: 280, ecc: "H", rounded: true
    }));
  };
  paintQr();
  // Подписки живут, пока страница в документе; после ухода — снимаются.
  const offs = [];
  const repaint = () => {
    if (!page.isConnected && page.dataset.seen) { offs.forEach(f => f()); return; }
    if (page.isConnected) page.dataset.seen = "1";
    paintQr();
  };
  offs.push(subscribeTheme(repaint), subscribeSkin(repaint));

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
        h("div", { class: "brand-qr-card" },
          h("div", { class: "brand-qr-head" },
            h("div", { class: "brand-qr-title" }, "SKILLBASE"),
            h("div", { class: "brand-qr-sub" }, "Официальная платформа")
          ),
          qrWrapper,
          h("p", { class: "brand-qr-hint" }, "Отсканируйте, чтобы открыть платформу"),
          h("div", { class: "btn-row brand-qr-actions" },
            h("a", { class: "btn primary", href: siteUrl, target: "_blank", rel: "noopener" }, "Открыть сайт"),
            h("button", { class: "btn secondary", id: "download-qr-btn", type: "button" }, "PNG")
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
        ctx.fillStyle = qrPalette().light;
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
