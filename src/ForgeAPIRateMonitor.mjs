export class ForgeAPI_RateMonitor {
  static reset(softReset = false) {
    this.debug = false; // ForgeAPI_RateMonitor.debug = true to log trace on every call
    this.timePeriod = 60 * 1000; // 1 minute; If the period changes, please review thresholds and APIRateMonitor messages
    this.warningFrequency = 10; // Every 10 calls to the same endpoint after a threshold logs another warning
    this.spikeWarningFrequency = 10 * this.warningFrequency; // Warn every 100 calls in a spike rather than 10
    this.spikeWarningThreshold = 10 * this.spikeWarningFrequency; // >= 1000 calls per minute indicates a spike
    this.sustainedUsageMonitorThreshold = 6 * this.warningFrequency; // >= 60 calls per minute may indicate sustained usage
    this.sustainedUsageWarningThreshold = 5; // Consecutive minutes that the monitor threshold has been hit
    this.monitoring = true;
    this.timeoutScheduled = false;
    this.tracker = this.tracker || {}; // Each endpoint called will be a key in this object
    if (softReset) {
      // Soft reset keeps count of consecutive periods that the warning threshold was reached per endpoint
      Object.keys(this.tracker).forEach((endpoint) => {
        // { calls: number, consecutive: number }
        if (this.tracker[endpoint].calls >= this.sustainedUsageMonitorThreshold) {
          this.tracker[endpoint].consecutive++; // Increment the consecutive counter
          this.tracker[endpoint].calls = 0; // Reset the call counter
        } else {
          delete this.tracker[endpoint]; // Not consecutively above threshold. Stop tracking this endpoint
        }
      });
    } else {
      this.tracker = {};
    }
  }

  static monitor(endpoint) {
    try {
      if (!this.monitoring) {
        this.reset();
      }
      // Initialize the tracker for this endpoint if not already present
      if (!this.tracker[endpoint]) {
        this.tracker[endpoint] = { calls: 0, consecutive: 0 };
      }
      // Increment the counter for this endpoint
      this.tracker[endpoint].calls++;
      if (this.debug) {
        this.logTrace(endpoint);
      }
      // Usage Spike: Warn per 100 calls if >= 1000 calls to the same endpoint in the current minute
      if (
        this.tracker[endpoint].calls >= this.spikeWarningThreshold &&
        this.tracker[endpoint].calls % this.spikeWarningFrequency === 0
      ) {
        const warning = game.i18n.format("THEFORGE.APIRateMonitorSpikeWarning", {
          endpoint,
          count: this.tracker[endpoint].calls,
        });
        ui.notifications.warn([warning, game.i18n.localize("THEFORGE.APIRateMonitorTroubleshooting")].join("<hr/>"));
        this.logTrace(endpoint);
      }
      // Sustained Usage: Warn per 10 calls if >= 60 calls per minute for 5 consecutive minutes
      if (
        this.tracker[endpoint].consecutive >= this.sustainedUsageWarningThreshold &&
        this.tracker[endpoint].calls % this.warningFrequency === 0
      ) {
        const warning = game.i18n.format("THEFORGE.APIRateMonitorSustainedUsageWarning", {
          endpoint,
          count: this.tracker[endpoint].consecutive,
        });
        ui.notifications.warn([warning, game.i18n.localize("THEFORGE.APIRateMonitorTroubleshooting")].join("<hr/>"));
        this.logTrace(endpoint);
      }
      // Schedule to reset the rate monitor data if not already scheduled
      if (!this.timeoutScheduled) {
        setTimeout(() => {
          this.reset(true); // Soft reset at period end so that consecutive counts can be maintained
        }, this.timePeriod);
        this.timeoutScheduled = true;
      }
    } catch (err) {
      console.error("The Forge API rate monitor has encountered an error", err);
    }
  }

  static logTrace(endpoint) {
    console.trace(
      game.i18n.format("THEFORGE.APIRateMonitorLogTrace", {
        endpoint,
        calls: this.tracker[endpoint].calls,
        consecutive: this.tracker[endpoint].consecutive,
      })
    );
  }
}
