package com.example.devicemanager.service;

import com.example.devicemanager.dto.AllInterfacesResponse;
import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.repository.DeviceRepository;
import com.example.devicemanager.repository.NetworkInterfaceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NetworkInterfaceServiceImplTest {

    @Mock
    private NetworkInterfaceRepository interfaceRepository;

    @Mock
    private DeviceRepository deviceRepository;

    @InjectMocks
    private NetworkInterfaceServiceImpl interfaceService;

    @Test
    void listInterfacesByDevice_returnsInterfacesForDevice() {
        // Arrange
        String deviceId = "device1";
        NetworkInterface iface1 = createTestInterface("iface1", deviceId, "eth0");
        NetworkInterface iface2 = createTestInterface("iface2", deviceId, "wlan0");
        when(interfaceRepository.findByDeviceId(deviceId)).thenReturn(Arrays.asList(iface1, iface2));

        // Act
        List<NetworkInterface> result = interfaceService.listInterfacesByDevice(deviceId);

        // Assert
        assertEquals(2, result.size());
        verify(interfaceRepository, times(1)).findByDeviceId(deviceId);
    }

    @Test
    void getInterface_interfaceExists_returnsInterface() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface iface = createTestInterface(interfaceId, deviceId, "eth0");
        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(iface));

        // Act
        Optional<NetworkInterface> result = interfaceService.getInterface(deviceId, interfaceId);

        // Assert
        assertTrue(result.isPresent());
        assertEquals(interfaceId, result.get().getId());
        verify(interfaceRepository, times(1)).findByIdAndDeviceId(interfaceId, deviceId);
    }

    @Test
    void getInterface_interfaceDoesNotExist_returnsEmpty() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.empty());

        // Act
        Optional<NetworkInterface> result = interfaceService.getInterface(deviceId, interfaceId);

        // Assert
        assertFalse(result.isPresent());
    }

    @Test
    void createInterface_validRequest_createsInterface() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        request.setIpAddress("192.168.1.100");
        request.setEnabled(true);

        when(deviceRepository.existsById(deviceId)).thenReturn(true);
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        NetworkInterface result = interfaceService.createInterface(deviceId, request);

        // Assert
        assertNotNull(result);
        assertEquals(deviceId, result.getDeviceId());
        assertEquals("eth0", result.getName());
        assertEquals(InterfaceType.ETHERNET, result.getType());
        assertEquals("AA:BB:CC:DD:EE:FF", result.getMacAddress());
        assertEquals("192.168.1.100", result.getIpAddress());
        assertEquals(InterfaceStatus.UNKNOWN, result.getStatus());
        assertTrue(result.getEnabled());
        assertNotNull(result.getId());

        verify(deviceRepository, times(1)).existsById(deviceId);
        verify(interfaceRepository, times(1)).save(any(NetworkInterface.class));
    }

    @Test
    void createInterface_deviceDoesNotExist_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");

        when(deviceRepository.existsById(deviceId)).thenReturn(false);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
        verify(interfaceRepository, never()).save(any());
    }

    @Test
    void createInterface_missingName_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_invalidMacAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("invalid-mac");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_invalidIpAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        request.setIpAddress("999.999.999.999");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_enabledDefaultsToTrue() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        // Note: enabled is not set

        when(deviceRepository.existsById(deviceId)).thenReturn(true);
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        NetworkInterface result = interfaceService.createInterface(deviceId, request);

        // Assert
        assertTrue(result.getEnabled());
    }

    @Test
    void updateInterface_validRequest_updatesInterface() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface existing = createTestInterface(interfaceId, deviceId, "eth0");
        existing.setIpAddress("192.168.1.100");

        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");
        request.setIpAddress("192.168.1.101");
        request.setEnabled(false);

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(existing));
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        Optional<NetworkInterface> result = interfaceService.updateInterface(deviceId, interfaceId, request);

        // Assert
        assertTrue(result.isPresent());
        assertEquals("eth1", result.get().getName());
        assertEquals("192.168.1.101", result.get().getIpAddress());
        assertFalse(result.get().getEnabled());

        verify(interfaceRepository, times(1)).save(any(NetworkInterface.class));
    }

    @Test
    void updateInterface_interfaceDoesNotExist_returnsEmpty() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.empty());

        // Act
        Optional<NetworkInterface> result = interfaceService.updateInterface(deviceId, interfaceId, request);

        // Assert
        assertFalse(result.isPresent());
        verify(interfaceRepository, never()).save(any());
    }

    @Test
    void updateInterface_invalidIpAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface existing = createTestInterface(interfaceId, deviceId, "eth0");

        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setIpAddress("invalid-ip");

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(existing));

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () ->
            interfaceService.updateInterface(deviceId, interfaceId, request));
    }

    @Test
    void deleteInterface_interfaceExists_deletesAndReturnsTrue() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.existsByIdAndDeviceId(interfaceId, deviceId)).thenReturn(true);

        // Act
        boolean result = interfaceService.deleteInterface(deviceId, interfaceId);

        // Assert
        assertTrue(result);
        verify(interfaceRepository, times(1)).deleteById(interfaceId);
    }

    @Test
    void deleteInterface_interfaceDoesNotExist_returnsFalse() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.existsByIdAndDeviceId(interfaceId, deviceId)).thenReturn(false);

        // Act
        boolean result = interfaceService.deleteInterface(deviceId, interfaceId);

        // Assert
        assertFalse(result);
        verify(interfaceRepository, never()).deleteById(anyString());
    }

    @Test
    void listAllInterfaces_noFilters_returnsAllWithPagination() {
        // Arrange
        NetworkInterface iface1 = createTestInterface("iface1", "device1", "eth0");
        NetworkInterface iface2 = createTestInterface("iface2", "device2", "wlan0");
        List<NetworkInterface> interfaces = Arrays.asList(iface1, iface2);

        Device device1 = new Device("device1", "Device-1", "192.168.1.1", "AA:BB:CC:DD:EE:FF", DeviceStatus.ONLINE);
        Device device2 = new Device("device2", "Device-2", "192.168.1.2", "AA:BB:CC:DD:EE:00", DeviceStatus.ONLINE);

        when(interfaceRepository.findAllWithFilters(null, null, null, null)).thenReturn(interfaces);
        when(deviceRepository.findById("device1")).thenReturn(Optional.of(device1));
        when(deviceRepository.findById("device2")).thenReturn(Optional.of(device2));

        // Act
        AllInterfacesResponse response = interfaceService.listAllInterfaces(null, null, null, null, 1, 50);

        // Assert
        assertEquals(2, response.getInterfaces().size());
        assertEquals("Device-1", response.getInterfaces().get(0).getDeviceName());
        assertEquals("Device-2", response.getInterfaces().get(1).getDeviceName());
        assertEquals(1, response.getPagination().getPage());
        assertEquals(50, response.getPagination().getPageSize());
        assertEquals(2, response.getPagination().getTotalItems());
        assertEquals(1, response.getPagination().getTotalPages());
    }

    @Test
    void listAllInterfaces_withFilters_returnsFilteredResults() {
        // Arrange
        NetworkInterface iface1 = createTestInterface("iface1", "device1", "eth0");
        iface1.setType(InterfaceType.ETHERNET);
        List<NetworkInterface> interfaces = Arrays.asList(iface1);

        Device device1 = new Device("device1", "Device-1", "192.168.1.1", "AA:BB:CC:DD:EE:FF", DeviceStatus.ONLINE);

        when(interfaceRepository.findAllWithFilters(eq("device1"), eq(InterfaceType.ETHERNET), eq(null), eq(true)))
                .thenReturn(interfaces);
        when(deviceRepository.findById("device1")).thenReturn(Optional.of(device1));

        // Act
        AllInterfacesResponse response = interfaceService.listAllInterfaces(
                "device1", InterfaceType.ETHERNET, null, true, 1, 50);

        // Assert
        assertEquals(1, response.getInterfaces().size());
        assertEquals("Device-1", response.getInterfaces().get(0).getDeviceName());
    }

    @Test
    void listAllInterfaces_pagination_returnsCorrectPage() {
        // Arrange
        NetworkInterface iface1 = createTestInterface("iface1", "device1", "eth0");
        NetworkInterface iface2 = createTestInterface("iface2", "device2", "wlan0");
        NetworkInterface iface3 = createTestInterface("iface3", "device3", "eth1");
        List<NetworkInterface> interfaces = Arrays.asList(iface1, iface2, iface3);

        Device device = new Device("device1", "Device", "192.168.1.1", "AA:BB:CC:DD:EE:FF", DeviceStatus.ONLINE);

        when(interfaceRepository.findAllWithFilters(null, null, null, null)).thenReturn(interfaces);
        when(deviceRepository.findById(anyString())).thenReturn(Optional.of(device));

        // Act - Get page 2 with pageSize 2
        AllInterfacesResponse response = interfaceService.listAllInterfaces(null, null, null, null, 2, 2);

        // Assert
        assertEquals(1, response.getInterfaces().size()); // Only 1 item on page 2
        assertEquals("iface3", response.getInterfaces().get(0).getId());
        assertEquals(2, response.getPagination().getPage());
        assertEquals(2, response.getPagination().getPageSize());
        assertEquals(3, response.getPagination().getTotalItems());
        assertEquals(2, response.getPagination().getTotalPages());
    }

    @Test
    void listAllInterfaces_invalidPage_throwsException() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () ->
                interfaceService.listAllInterfaces(null, null, null, null, 0, 50));
    }

    @Test
    void listAllInterfaces_invalidPageSize_throwsException() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () ->
                interfaceService.listAllInterfaces(null, null, null, null, 1, 101));
        assertThrows(IllegalArgumentException.class, () ->
                interfaceService.listAllInterfaces(null, null, null, null, 1, 0));
    }

    @Test
    void listAllInterfaces_deviceNotFound_returnsUnknownDeviceName() {
        // Arrange
        NetworkInterface iface1 = createTestInterface("iface1", "device1", "eth0");
        List<NetworkInterface> interfaces = Arrays.asList(iface1);

        when(interfaceRepository.findAllWithFilters(null, null, null, null)).thenReturn(interfaces);
        when(deviceRepository.findById("device1")).thenReturn(Optional.empty());

        // Act
        AllInterfacesResponse response = interfaceService.listAllInterfaces(null, null, null, null, 1, 50);

        // Assert
        assertEquals(1, response.getInterfaces().size());
        assertEquals("Unknown", response.getInterfaces().get(0).getDeviceName());
    }

    private NetworkInterface createTestInterface(String id, String deviceId, String name) {
        NetworkInterface iface = new NetworkInterface();
        iface.setId(id);
        iface.setDeviceId(deviceId);
        iface.setName(name);
        iface.setType(InterfaceType.ETHERNET);
        iface.setMacAddress("AA:BB:CC:DD:EE:FF");
        iface.setStatus(InterfaceStatus.UP);
        iface.setEnabled(true);
        return iface;
    }
}
