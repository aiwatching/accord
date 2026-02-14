package com.example.devicemanager.service;

import com.example.devicemanager.dto.AllInterfacesResponse;
import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.InterfaceWithDevice;
import com.example.devicemanager.dto.PaginationMetadata;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.repository.DeviceRepository;
import com.example.devicemanager.repository.NetworkInterfaceRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

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

    @Override
    public AllInterfacesResponse listAllInterfaces(String deviceId, InterfaceType type,
                                                   InterfaceStatus status, Boolean enabled,
                                                   int page, int pageSize) {
        // Validate pagination parameters
        if (page < 1) {
            throw new IllegalArgumentException("Page must be >= 1");
        }
        if (pageSize < 1 || pageSize > 100) {
            throw new IllegalArgumentException("Page size must be between 1 and 100");
        }

        // Get filtered results
        List<NetworkInterface> allInterfaces = interfaceRepository.findAllWithFilters(
                deviceId, type, status, enabled);

        // Count total items
        long totalItems = allInterfaces.size();

        // Apply pagination
        int startIndex = (page - 1) * pageSize;
        int endIndex = Math.min(startIndex + pageSize, allInterfaces.size());

        List<NetworkInterface> paginatedInterfaces = allInterfaces.subList(
                Math.min(startIndex, allInterfaces.size()),
                endIndex
        );

        // Enrich with device names
        List<InterfaceWithDevice> enrichedInterfaces = paginatedInterfaces.stream()
                .map(this::enrichWithDeviceName)
                .collect(Collectors.toList());

        // Create pagination metadata
        PaginationMetadata pagination = new PaginationMetadata(page, pageSize, totalItems);

        return new AllInterfacesResponse(enrichedInterfaces, pagination);
    }

    private InterfaceWithDevice enrichWithDeviceName(NetworkInterface networkInterface) {
        InterfaceWithDevice result = new InterfaceWithDevice();
        result.setId(networkInterface.getId());
        result.setDeviceId(networkInterface.getDeviceId());
        result.setName(networkInterface.getName());
        result.setType(networkInterface.getType());
        result.setMacAddress(networkInterface.getMacAddress());
        result.setIpAddress(networkInterface.getIpAddress());
        result.setStatus(networkInterface.getStatus());
        result.setEnabled(networkInterface.getEnabled());
        result.setCreatedAt(networkInterface.getCreatedAt());
        result.setUpdatedAt(networkInterface.getUpdatedAt());

        // Get device name from repository
        Optional<Device> device = deviceRepository.findById(networkInterface.getDeviceId());
        result.setDeviceName(device.map(Device::getName).orElse("Unknown"));

        return result;
    }
}
