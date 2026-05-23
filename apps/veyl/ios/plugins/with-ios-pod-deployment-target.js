const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const START_MARKER = '    # @glyphteck pod deployment target start';
const END_MARKER = '    # @glyphteck pod deployment target end';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function podDeploymentTargetBlock(deploymentTarget) {
    return `${START_MARKER}
    deployment_target = Gem::Version.new('${deploymentTarget}')
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next if current && Gem::Version.new(current) >= deployment_target

        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = deployment_target.to_s
      end
    end
${END_MARKER}
`;
}

function updatePodfile(contents, deploymentTarget) {
    const block = podDeploymentTargetBlock(deploymentTarget);

    if (contents.includes(START_MARKER)) {
        const markerPattern = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`);
        return contents.replace(markerPattern, block);
    }

    const postInstallCallPattern = / {4}react_native_post_install\([\s\S]*?\n {4}\)\n/;
    if (!postInstallCallPattern.test(contents)) {
        throw new Error('Expected react_native_post_install block in generated Podfile.');
    }

    return contents.replace(postInstallCallPattern, (match) => `${match}${block}`);
}

module.exports = function withIosPodDeploymentTarget(config, props = {}) {
    const deploymentTarget = props.deploymentTarget || '26.5';

    return withDangerousMod(config, [
        'ios',
        async (modConfig) => {
            const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
            const contents = await fs.promises.readFile(podfilePath, 'utf8');
            const nextContents = updatePodfile(contents, deploymentTarget);

            if (nextContents !== contents) {
                await fs.promises.writeFile(podfilePath, nextContents);
            }

            return modConfig;
        },
    ]);
};
