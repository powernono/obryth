import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],clearScreen:false,server:{strictPort:true},build:{target:'es2022',chunkSizeWarningLimit:1100}});
