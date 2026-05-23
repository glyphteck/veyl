const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

const LINKER_FLAGS = ['-Wl,-keep_dwarf_unwind', '-Wl,-no_compact_unwind'];

function quoteBuildSetting(value) {
    if (value.startsWith('"') && value.endsWith('"')) {
        return value;
    }

    return `"${value}"`;
}

function normalizeBuildSettingList(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (!value) {
        return ['"$(inherited)"'];
    }

    return [value];
}

function addLinkerFlags(buildSettings) {
    const current = normalizeBuildSettingList(buildSettings.OTHER_LDFLAGS);
    const normalized = new Set(current.map((value) => value.replace(/^"|"$/g, '')));

    for (const flag of LINKER_FLAGS) {
        if (!normalized.has(flag)) {
            current.push(quoteBuildSetting(flag));
        }
    }

    buildSettings.OTHER_LDFLAGS = current;
}

module.exports = function withIosLinkerUnwindFlags(config) {
    return withXcodeProject(config, (modConfig) => {
        const project = modConfig.modResults;
        const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
            project,
            projectName: modConfig.modRequest.projectName,
        });
        const buildConfigurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
            project,
            appTarget.target.buildConfigurationList
        );

        for (const [, buildConfiguration] of buildConfigurations) {
            addLinkerFlags(buildConfiguration.buildSettings);
        }

        return modConfig;
    });
};
