<template>
  <!-- Raw HTML and images are disabled in the parser; links use the native host. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="release-notes" @click="openLink" v-html="rendered" />
</template>

<script>
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true }).disable(
  "image",
);
markdown.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

export default {
  name: "ReleaseNotes",
  props: {
    notes: { type: String, default: "" },
    releaseUrl: { type: String, default: "" },
  },
  emits: ["error"],
  computed: {
    rendered() {
      return markdown.render(this.notes || "No release notes provided.");
    },
  },
  methods: {
    async openLink(event) {
      const link = event.target.closest("a");
      if (!link || !event.currentTarget.contains(link)) return;
      event.preventDefault();
      try {
        const url = new URL(
          link.getAttribute("href"),
          this.releaseUrl || undefined,
        );
        if (url.protocol !== "https:" || url.username || url.password) {
          throw new Error("Only HTTPS release-note links can be opened.");
        }
        await window.cats.app.openExternal(url.href);
      } catch (error) {
        this.$emit("error", error.message);
      }
    },
  },
};
</script>

<style scoped>
.release-notes {
  overflow-x: auto;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.release-notes :deep(h1),
.release-notes :deep(h2),
.release-notes :deep(h3) {
  margin: 1.3em 0 0.5em;
  line-height: 1.3;
  font-size: 1.15em;
}
.release-notes :deep(p),
.release-notes :deep(ul),
.release-notes :deep(ol),
.release-notes :deep(pre),
.release-notes :deep(table) {
  margin-bottom: 1em;
}
.release-notes :deep(ul),
.release-notes :deep(ol) {
  padding-left: 1.5em;
}
.release-notes :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.release-notes :deep(th),
.release-notes :deep(td) {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  padding: 0.45em 0.65em;
  text-align: left;
}
.release-notes :deep(code),
.release-notes :deep(pre) {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 4px;
  padding: 0.15em 0.3em;
}
.release-notes :deep(pre) {
  padding: 0.75em;
  overflow-x: auto;
}
.release-notes :deep(a) {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}
.release-notes :deep(blockquote) {
  border-left: 3px solid rgba(var(--v-theme-on-surface), 0.25);
  padding-left: 1em;
  margin-bottom: 1em;
}
.release-notes :deep(:first-child) {
  margin-top: 0;
}
</style>
