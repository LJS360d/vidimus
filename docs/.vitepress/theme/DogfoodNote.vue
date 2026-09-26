<script setup lang="ts">
import { withBase } from 'vitepress';
import { dogfoodNote } from '../../flavors.ts';
</script>

<template>
  <p class="dogfood">
    {{ dogfoodNote }} <a :href="withBase('/flavors')">Why</a>.
  </p>
</template>
