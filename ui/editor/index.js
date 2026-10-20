import EditorComponent from './EditorComponent.js'
import { AuthProvider } from '../authContext.js'
import { createRoot } from 'https://unpkg.com/react@18/umd/react.development.js'
import { BrowserRouter } from 'https://unpkg.com/react-router-dom@6/umd/react-router-dom.development.js'

// Инициализация приложения
const root = createRoot(document.getElementById('root'));

root.render(
  <AuthProvider>
    <BrowserRouter>
      <EditorComponent />
    </BrowserRouter>
  </AuthProvider>
)