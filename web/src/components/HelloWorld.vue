<script setup lang="ts">
const hello = useHelloWorld()
</script>

<template>
  <div class="text-[#E9994C] bg-[#090909] flex h-100vh w-100vw items-center justify-center">
    <div class="relative">
      <div class="text-[#cc4c19] font-bold pointer-events-none select-none text-nowrap top-0 absolute blur-20">
        {{ hello }}
      </div>
      <div>
        {{ hello }}
      </div>
    </div>
  </div>
</template>
