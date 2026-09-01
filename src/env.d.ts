/// <reference types="vite/client" />

import type { DefineComponent } from 'vue'

declare module '*.vue' {
  const component: DefineComponent<object, object, any>
  export default component
}

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    window: Window
  }
}

export {}
