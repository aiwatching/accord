package com.example.devicemanager.service;

import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.repository.DeviceRepository;
import com.example.devicemanager.repository.NetworkInterfaceRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class NetworkInterfaceServiceImpl implements NetworkInterfaceService {

    private final NetworkInterfaceRepository interfaceRepository;
    private final DeviceRepository deviceRepository;

    // Regex patterns for validation
    private static final Pattern MAC_ADDRESS_PATTERN =
        Pattern.compile("^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$");
    private static final Pattern IP_ADDRESS_PATTERN =
        Pattern.compile("^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$");
    private static final Pattern INTERFACE_NAME_PATTERN =
        Pattern.compile("^[a-zA-Z0-9_-]+$");

    public NetworkInterfaceServiceImpl(NetworkInterfaceRepository interfaceRepository,
                                      DeviceRepository deviceRepository) {
        this.interfaceRepository = interfaceRepository;
        this.deviceRepository = deviceRepository;
    }

    @Override
    public List<NetworkInterface> listInterfacesByDevice(String deviceId) {
        return interfaceRepository.findByDeviceId(deviceId);
    }

    @Override
    public Optional<NetworkInterface> getInterface(String deviceId, String interfaceId) {
        return interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId);
    }

    @Override
    public NetworkInterface createInterface(String deviceId, CreateInterfaceRequest request) {
        // Validate device exists
        if (!deviceRepository.existsById(deviceId)) {
            throw new IllegalArgumentException("Device not found: " + deviceId);
        }

        // Validate required fields
        if (request.getName() == null || request.getName().trim().isEmpty()) {
            throw new IllegalArgumentException("Interface name is required");
        }
        if (request.getType() == null) {
            throw new IllegalArgumentException("Interface type is required");
        }
        if (request.getMacAddress() == null || request.getMacAddress().trim().isEmpty()) {
            throw new IllegalArgumentException("MAC address is required");
        }

        // Validate formats
        if (!INTERFACE_NAME_PATTERN.matcher(request.getName()).matches()) {
            throw new IllegalArgumentException("Invalid interface name format. Use only alphanumeric characters, hyphens, and underscores.");
        }
        if (!MAC_ADDRESS_PATTERN.matcher(request.getMacAddress()).matches()) {
            throw new IllegalArgumentException("Invalid MAC address format. Expected format: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX");
        }
        if (request.getIpAddress() != null && !request.getIpAddress().trim().isEmpty()) {
            if (!IP_ADDRESS_PATTERN.matcher(request.getIpAddress()).matches()) {
                throw new IllegalArgumentException("Invalid IP address format");
            }
        }

        // Create the interface
        NetworkInterface networkInterface = new NetworkInterface();
        networkInterface.setId(UUID.randomUUID().toString());
        networkInterface.setDeviceId(deviceId);
        networkInterface.setName(request.getName());
        networkInterface.setType(request.getType());
        networkInterface.setMacAddress(request.getMacAddress());
        networkInterface.setIpAddress(request.getIpAddress());
        networkInterface.setStatus(InterfaceStatus.UNKNOWN);
        networkInterface.setEnabled(request.getEnabled() != null ? request.getEnabled() : true);
        networkInterface.setCreatedAt(Instant.now());
        networkInterface.setUpdatedAt(Instant.now());

        return interfaceRepository.save(networkInterface);
    }

    @Override
    public Optional<NetworkInterface> updateInterface(String deviceId, String interfaceId, UpdateInterfaceRequest request) {
        Optional<NetworkInterface> existing = interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId);

        if (existing.isEmpty()) {
            return Optional.empty();
        }

        NetworkInterface networkInterface = existing.get();

        // Validate and update name
        if (request.getName() != null && !request.getName().trim().isEmpty()) {
            if (!INTERFACE_NAME_PATTERN.matcher(request.getName()).matches()) {
                throw new IllegalArgumentException("Invalid interface name format. Use only alphanumeric characters, hyphens, and underscores.");
            }
            networkInterface.setName(request.getName());
        }

        // Update type
        if (request.getType() != null) {
            networkInterface.setType(request.getType());
        }

        // Validate and update IP address
        if (request.getIpAddress() != null && !request.getIpAddress().trim().isEmpty()) {
            if (!IP_ADDRESS_PATTERN.matcher(request.getIpAddress()).matches()) {
                throw new IllegalArgumentException("Invalid IP address format");
            }
            networkInterface.setIpAddress(request.getIpAddress());
        }

        // Update enabled status
        if (request.getEnabled() != null) {
            networkInterface.setEnabled(request.getEnabled());
        }

        networkInterface.setUpdatedAt(Instant.now());

        return Optional.of(interfaceRepository.save(networkInterface));
    }

    @Override
    public boolean deleteInterface(String deviceId, String interfaceId) {
        if (!interfaceRepository.existsByIdAndDeviceId(interfaceId, deviceId)) {
            return false;
        }
        interfaceRepository.deleteById(interfaceId);
        return true;
    }
}
