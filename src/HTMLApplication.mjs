/** @typedef {foundry.applications.types.ApplicationConfiguration} AppConfig */

/**
 * A simplified implementation of `ApplicationV2` that allows for easy rendering of
 * arbitrary HTML content.
 * @class
 * @type {new foundry.applications.api.ApplicationV2}
 */
export let HTMLApplication;

try {
  HTMLApplication = class extends foundry.applications.api.ApplicationV2 {
    /** @typedef {string|Node|NodeList|HTMLTemplateElement} Renderable */

    /**
     * @callback contentCallback
     * @param {ApplicationRenderContext} context - The rendering context
     * @param {RenderOptions} options            - The rendering options
     * @returns {Renderable} - The content to render
     */

    /**
     * @callback renderCallback
     * @param {HTMLElement} element              - The HTML element to render into
     * @param {ApplicationRenderContext} context - The rendering context
     * @param {RenderOptions} options            - The rendering options
     */

    /**
     * @param {Object} options
     * @param {Renderable|contentCallback} options.content - The content to render, either as a renderable value or a function
     *                                                       returning something that can be resolved by {@link _replaceHTML}
     * @param {renderCallback} options.render              - A callback function to execute when the application is rendered.
     * @param {AppConfig} options.options                  - Additional application options.
     */
    constructor({ content, render, ...options }) {
      super(options);

      this.renderContent = typeof content == "function" ? content : () => content;
      this.onRender = render;
    }

    /**
     * Render an HTMLElement for the Application.
     * @param {ApplicationRenderContext} context - Context data for the render operation
     * @param {RenderOptions} options            - Options which configure application rendering behavior
     * @returns {Promise<Renderable>}            - The content to display in the application
     */
    async _renderHTML(context, options) {
      return this.renderContent.call(this, context, options);
    }

    /**
     * Actions performed after any render of the Application.
     * @param {ApplicationRenderContext} context - Prepared context data
     * @param {RenderOptions} options            - Provided render options
     * @returns {Promise<void>}
     */
    async _onRender(context, options) {
      return this.onRender.call(this, this.element, context, options);
    }

    /**
     * Replace the HTML of the application with the result provided by the rendering backend.
     * @param {Renderable} result     - The result returned by the application rendering backend
     * @param {HTMLElement} content   - The content element into which the rendered result must be inserted
     * @param {RenderOptions} options - Options which configure application rendering behavior
     */
    _replaceHTML(result, content, options) {
      if (typeof result === "string") content.innerHTML = result;
      else if (result instanceof HTMLTemplateElement) {
        content.replaceChildren(result.content);
      } else {
        content.replaceChildren(result); // Result is a Node or NodeList
      }
    }
  };
} catch {
  // noop
}
