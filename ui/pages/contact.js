// ui/pages/contact.js — Контакты и обратная связь Skillbase.
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { State } from "../../core/auth.js";

export default function ContactPage() {
  const page = docPage({
    eyebrow: "Связь",
    title: "Контакты NewRail",
    subtitle: "Мы открыты к конструктивной обратной связи и сотрудничеству.",
    extra: [
      h("a", { href: "#contact-en" }, "English version"),
      " · ",
      h("a", { href: "mailto:bujlenkovdaniil@gmail.com" }, "Сообщить об ошибке")
    ],
      {
        id: "intro",
        title: "Свяжитесь с нами",
        blocks: [
          h("p", {}, "Есть вопросы по работе Skillbase, предложения по развитию платформы или сообщения об обнаруженных ошибках? Свяжитесь с командой NewRail удобным для вас способом. Мы ценим мнение каждого пользователя."),
          h("div", { class: "contact-main", style: "margin: var(--space-4) 0; padding: var(--space-4); background: var(--ok-bg); border: 1px solid var(--ok-border); border-radius: var(--radius-m);" },
            h("div", { style: "font-weight: 700; color: var(--ok); margin-bottom: var(--space-1);" }, "Основной канал связи — Telegram"),
            h("a", {
              href: "https://t.me/Frozencode_f",
              target: "_blank",
              style: "font-size: 1.25rem; font-weight: 700; text-decoration: none; color: var(--ok);"
            }, "@Frozencode_f")
          )
        ]
      },
      {
        id: "channels",
        title: "Все способы связи",
        blocks: [
          h("div", { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3);" },
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Telegram (дополнительный)"),
              h("a", { href: "https://t.me/YourAssistantWeb", target: "_blank" }, "@YourAssistantWeb")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Электронная почта"),
              h("a", { href: "mailto:bujlenkovdaniil@gmail.com" }, "bujlenkovdaniil@gmail.com")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Instagram"),
              h("a", { href: "https://www.instagram.com/core.singl?psln=MWkzcXg1YWoxNnVyZA==", target: "_blank" }, "@core.singl")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "GitHub"),
              h("a", { href: "https://github.com/NewRail-project/skillbase", target: "_blank" }, "Проект на GitHub")
            )
          )
        ]
      },
      {
        id: "team",
        title: "Команда проекта",
        blocks: [
          h("ul", { style: "list-style: none; padding: 0;" },
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Буйленков Даниил Дмитриевич"), h("br"),
              h("span", { class: "muted" }, "Главный разработчик: архитектура, программирование, техническая организация.")
            ),
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Голубятников Никита"), h("br"),
              h("span", { class: "muted" }, "Продукт и дизайн: интерфейс, визуальная концепция, анализ возможностей.")
            ),
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Черный Богдан"), h("br"),
              h("span", { class: "muted" }, "Продукт и презентация: идеи развития, концепции, подготовка презентаций.")
            )
          )
        ]
      },
      {
        id: "info",
        title: "Информация о платформе",
        blocks: [
          h("p", { class: "muted" },
            "Проект: Skillbase", h("br"),
            "Команда: NewRail", h("br"),
            "Версия: 1.0.0", h("br"),
            "Год: 2026", h("br"),
            "Сайт: ", h("a", { href: "https://newrail-project.github.io/skillbase/#/" }, "newrail-project.github.io/skillbase")
          ),
          h("p", { style: "font-style: italic; margin-top: var(--space-4); font-weight: 500;" }, "«Skillbase — знания, которые движут отрасль вперёд»")
        ]
      }
    ]
  });

  scrollToDocSection(page, State.routeParam);
  return page;
}
