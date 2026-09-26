<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';
import { flavorLinks, slugOf } from '../../flavors.ts';

const { page } = useData();
const links = computed(() => flavorLinks('vitepress', slugOf(page.value.relativePath)));
</script>

<template>
  <nav class="flavors" aria-label="Docs flavor">
    <span>Same docs, built with</span>
    <a
      v-for="link in links"
      :key="link.name"
      :href="link.href"
      :aria-current="link.current ? 'page' : undefined"
      >{{ link.name }}</a
    >
  </nav>
</template>
