const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const headingIds = (md) => {
  md.core.ruler.push('heading_ids', (state) => {
    const seen = new Map();
    state.tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const text = state.tokens[index + 1]?.children
        ?.filter(({ type }) => type === 'text' || type === 'code_inline')
        .map(({ content }) => content)
        .join('');
      const slug = slugify(text ?? '');
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      token.attrSet('id', count ? `${slug}-${count}` : slug);
    });
  });
};

export default (eleventyConfig) => {
  eleventyConfig.amendLibrary('md', (md) => md.use(headingIds));
  eleventyConfig.addPassthroughCopy({ static: '/' });
};

export const config = {
  dir: { input: 'content', includes: '../layouts', data: '../data', output: '../dist/eleventy' },
  pathPrefix: '/vidimus/eleventy/',
  markdownTemplateEngine: false,
};
