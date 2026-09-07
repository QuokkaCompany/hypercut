import React from 'react';
import { createRoot } from 'react-dom/client';
import RuntimeApp from './Cloud';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><RuntimeApp /></React.StrictMode>);
