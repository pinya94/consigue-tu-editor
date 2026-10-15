import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Acceso de depuración (consola F12 o capturas automáticas)
import { clock } from './clock';
(window as any).__editor = { clock };
