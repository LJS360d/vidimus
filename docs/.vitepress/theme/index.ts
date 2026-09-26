import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import { base, flavors } from '../../flavors.ts';
import DogfoodNote from './DogfoodNote.vue';
import FlavorSwitch from './FlavorSwitch.vue';
import './style.css';

const otherFlavors = flavors.filter(({ path }) => path).map(({ path }) => `${base}${path}`);

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-top': () => h(FlavorSwitch),
      'doc-footer-before': () => h(DogfoodNote),
    }),
  enhanceApp: ({ router }) => {
    router.onBeforeRouteChange = (to) => {
      if (!otherFlavors.some((prefix) => to.startsWith(prefix))) return;
      window.location.assign(to);
      return false;
    };
  },
} satisfies typeof DefaultTheme;
