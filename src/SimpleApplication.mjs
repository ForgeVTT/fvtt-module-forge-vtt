/**
 * A simplified implementation of `ApplicationV2` that allows for easy rendering of
 * arbitrary HTML content.
 * @class
 * @type {new foundry.applications.api.ApplicationV2}
 */
export let SimpleApplication;

try {
  SimpleApplication = class extends foundry.applications.api.ApplicationV2 {
    /**
     * @param {Object} options
     * @param {string|(ApplicationRenderContext, RenderOptions)
     *                  => string|Node|NodeList|HTMLTemplateElement} options.content          - The content to render, either as a string or a function
     *                                                                                          returning something that can be resolved by {@link _replaceHTML}
     * @param {(HTMLElement, ApplicationRenderContext, RenderOptions) => void} options.render - A callback function to execute when the application is rendered.
     * @param {foundry.applications.types.ApplicationConfiguration} options.options           - Additional application options.
     */
    constructor({ content, render, ...options }) {
      super(options);

      this.renderContent = typeof content == "function" ? content : () => content;
      this.onRender = render;
    }

    /**
     * Render an HTMLElement for the Application.
     * @param {ApplicationRenderContext} context                    - Context data for the render operation
     * @param {RenderOptions} options                               - Options which configure application rendering behavior
     * @returns {Promise<string|Node|NodeList|HTMLTemplateElement>} - The content to display in the application
     */
    async _renderHTML(context, options) {
      return this.renderContent.call(this, context, options);
    }

    /**
     * Actions performed after any render of the Application.
     * @param {ApplicationRenderContext} context      - Prepared context data
     * @param {RenderOptions} options                 - Provided render options
     * @returns {Promise<void>}
     */
    async _onRender(context, options) {
      return this.onRender.call(this, this.element, context, options);
    }

    /**
     * Replace the HTML of the application with the result provided by the rendering backend.
     * @param {string|Node|NodeList|HTMLTemplateElement} result - The result returned by the application rendering backend
     * @param {HTMLElement} content                                      - The content element into which the rendered result must be inserted
     * @param {RenderOptions} options                                    - Options which configure application rendering behavior
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
