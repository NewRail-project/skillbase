// ui/pages/create-test.js
import { parseQuizText } from '../../core/editor.js';

export default function CreateTestComponent() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Создание теста</h2>
    <textarea id="quiz-text" placeholder="Введите текст теста..."></textarea>
    <button id="parse-btn">Разобрать</button>
    <div id="preview"></div>
  `;
  
  const parseBtn = div.querySelector('#parse-btn');
  const quizText = div.querySelector('#quiz-text');
  const preview = div.querySelector('#preview');
  
  parseBtn.addEventListener('click', async () => {
    try {
      const parsed = await parseQuizText(quizText.value);
      preview.innerHTML = `
        <h3>Предпросмотр:</h3>
        <div class="questions">
          ${parsed.questions.map((q, i) => `
            <div class="question">
              <h4>Вопрос ${i + 1}: ${q.text}</h4>
              <div class="options">
                ${q.options.map((o, j) => `
                  <div class="option">
                    <input type="radio" name="q${i}" value="${j}" />
                    <span>${o.text}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      preview.textContent = '';
      const msg = document.createElement('p');
      msg.className = 'error';
      msg.textContent = e.message;
      preview.appendChild(msg);
    }
  });
  
  return div;
}