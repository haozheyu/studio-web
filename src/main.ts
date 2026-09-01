import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import './studio.css'

const app = createApp(App)
app.config.globalProperties.window = window
app.mount('#app')
