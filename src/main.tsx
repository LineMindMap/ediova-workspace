import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './polish.css';
import './payments.css';
import { installPolish } from './lib/polish';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

installPolish();
